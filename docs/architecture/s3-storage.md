# S3 object storage (AWS)

## How it works

- **Driver:** `STORAGE_DRIVER=s3` (in `apps/api/src/storage/index.ts`). On AWS, leave `S3_ACCESS_KEY_ID` and
  `S3_SECRET_ACCESS_KEY` empty. The SDK's default credential chain then picks up the **EC2 instance role's**
  short-lived credentials. Static keys are only for non-AWS endpoints such as Cloudflare R2 (`S3_ENDPOINT`).
- **The bucket stays private.** The browser never gets bucket credentials, only **presigned URLs**:
  - **Upload parts:** `PUT`. The URL is issued per part, valid for `PRESIGN_TTL_SECS` (default 900 s), and only
    for that part of that upload.
  - **Downloads:** `GET /download/:token?direct=1`. The API checks the same entitlement, then redirects to a
    presigned `GET` that lives at most 300 s. Without `?direct=1` the API streams the file itself, as before.
- **Per-customer prefixes:** new objects are stored as `tenants/<accountId>/<category>/<assetId>/<versionId>/<random>`.
  - Every upload operation checks DB ownership **and** that the key sits under the caller's prefix.
  - Older objects (`marketplace-assets/…`) stay where they are and are reachable only through DB ownership.

### Storage categories

| Category | Purposes | Paid by | Limit |
|---|---|---|---|
| `workflow` | bounty submissions, dispute evidence, failure examples, verification inputs | bounty or order escrow | `SUBMISSION_MAX_BYTES` per submission version (default 5 GB). Not counted in the quota |
| `customer` | marketplace listings, models, benchmarks, plain storage | the customer | quota = `FREE_STORAGE_BYTES` (MVP free tier, default 1 GB) + active monthly plans |

### Quotas and reservations (PostgreSQL)

- Opening an upload **reserves** its declared size: an `uploads` row with `status='open'` and `category='customer'`.
- The quota check and the insert run in one transaction under a per-account `pg_advisory_xact_lock`, so
  parallel uploads can't jointly go over the quota.
- A reservation is released when the upload completes (it becomes a stored file), is aborted, or expires.
  Expired uploads are aborted on S3 by the hourly cleanup (`purgeExpiredUploads`). Uploads expire after 24 h.
- **Monthly plans:** `GET /storage/plans` lists the plans (`STORAGE_PLANS_GB`, default `10,50,200,1000`, 30 days each).
  `POST /storage/allocations {gb, termDays: 30}` creates the invoice, and the plan becomes active once paid.
  Expired plans get a 14-day read-only grace period. After that, the oldest unprotected assets are deleted
  until usage fits the quota again.
- **Size limits:** `MAX_FILE_BYTES`, `MAX_UPLOAD_BYTES` (per version), `SUBMISSION_MAX_BYTES`, and an
  allowed-media-type list. Part sizes and per-part SHA-256 are checked, and after assembly the whole object's
  SHA-256 is verified on the server.

## Environment (EC2)

```
STORAGE_DRIVER=s3
S3_BUCKET=edgebounty-uploads-rezus-2026
S3_REGION=eu-north-1
DATABASE_URL=postgres://edgebounty:<generated>@127.0.0.1:5432/edgebounty
# optional
PRESIGN_TTL_SECS=900
SUBMISSION_MAX_BYTES=5368709120
STORAGE_PLANS_GB=10,50,200,1000
FREE_STORAGE_BYTES=1073741824
```

`infrastructure/ec2/setup.sh` writes all of this when it runs with
`S3_BUCKET=edgebounty-uploads-rezus-2026 AWS_REGION=eu-north-1`. It also installs PostgreSQL bound to localhost.

## Settings you still need to change in the AWS console

1. **Bucket → Permissions → Block public access:** all four options **On**. They are on by default; leave them on.
2. **Bucket → Permissions → Cross-origin resource sharing (CORS).** Paste:
   ```json
   [
     {
       "AllowedOrigins": ["https://13-61-207-211.sslip.io"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   `ETag` must be exposed, or the browser can't read part ETags. Add your real domain here once you have one.
3. **Bucket → Management → Create lifecycle rule:**
   - Name: `abort-incomplete-multipart`
   - Scope: **apply to all objects**
   - Action: **Delete expired object delete markers or incomplete multipart uploads**
   - Set **Delete incomplete multipart uploads** to **2 days**

   This is a backstop if the API's own cleanup never runs.
4. **Bucket → Properties → Default encryption:** SSE-S3 (the default). Make sure it's enabled.
5. **IAM → Policies → `EdgeBountyS3Access`:** your policy already covers everything the API does
   (`ListBucket`, `Get/Put/DeleteObject`, `AbortMultipartUpload`, `ListMultipartUploadParts`). Nothing to add.
6. **Only if you run the API in Docker on EC2:** EC2 → instance → **Actions → Instance settings → Modify instance
   metadata options** → set **Metadata response hop limit = 2**, so containers can reach the instance role.
   The current pm2 setup doesn't need this.

Optional: **Bucket → Properties → Bucket Versioning** protects against accidental deletes, but costs storage
for old versions. It's off by default; fine for the MVP.
