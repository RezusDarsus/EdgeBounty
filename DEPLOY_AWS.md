# Deploy the hackathon demo to one EC2 instance

This version uses SOL payments. Before deploying over an older USDC demo, preserve its ledger and
database and provision a separate SOL environment. The revised bootstrap and API refuse the legacy
payment mint. See [approved-marketplace-flows](docs/approved-marketplace-flows.md) for migration limits.

The whole stack runs on one box: a Solana test validator with the program preloaded, the API, and the
web app. Caddy puts them behind free HTTPS hostnames (`<ip>.sslip.io`), so you don't need to buy a domain.
The faucet and the Dev Burner wallet keep working, and Level 3 AI checks call NVIDIA's hosted API
(no GPU needed). **Demo only: this is a private test chain, not real funds.**

## 1. Instance settings (AWS console → EC2)
- **AMI:** Ubuntu Server 24.04 LTS
- **Type:** `t3.large` (8 GB RAM) or bigger. `t3.medium` works but builds slowly.
- **Disk:** 30 GB
- **Security group, inbound:** SSH 22 (My IP), HTTP 80 (0.0.0.0/0), HTTPS 443 (0.0.0.0/0).
  Ports 80 and 443 must be open or the HTTPS certificate can't be issued.
- Optional: attach an **Elastic IP** so the address doesn't change when the instance restarts.

## 2. Upload the project (PowerShell on your PC)
```powershell
icacls "C:\path\to\your-key.pem" /inheritance:r /grant:r "$($env:USERNAME):R"
scp -i "C:\path\to\your-key.pem" C:\Users\rezus\Desktop\SOLANA\edgebounty.tar.gz ubuntu@<PUBLIC-IP>:~
```
`edgebounty.tar.gz` holds the code, the built program and `apps/api/.env` (with the NVIDIA key).
Rebuild it after code changes (see step 5).

## 3. Connect and run the setup (about 10–15 minutes the first time)
```powershell
ssh -i "C:\path\to\your-key.pem" ubuntu@<PUBLIC-IP>
```
Then on the server:
```bash
tar -xzf edgebounty.tar.gz && cd edgebounty && bash infrastructure/ec2/setup.sh
```
At the end it prints your URL, e.g. `https://3-120-45-67.sslip.io`.

## 4. Check it
- `https://api.<ip>.sslip.io/health` should return `{"ok":true,"chain":true,...}`
- Open the site → wallet menu → **Dev Burner** → *Sign in with Solana* → *Faucet*
- Logs: `pm2 logs`, status: `pm2 ls`, restart one service: `pm2 restart api`

## 5. Update after code changes
On your PC (in `C:\Users\rezus\Desktop\SOLANA`), rebuild the archive and upload it again:
```bash
tar --exclude=node_modules --exclude=.venv --exclude=.next --exclude=.data --exclude=__pycache__ --exclude=./edgebounty/.claude --exclude=./edgebounty/.openai --exclude=./edgebounty/target/debug --exclude=./edgebounty/target/release -czf edgebounty.tar.gz ./edgebounty
```
Then on the server, run `tar -xzf edgebounty.tar.gz && cd edgebounty && bash infrastructure/ec2/setup.sh` again.
Chain state and uploaded data are kept.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Browser shows a certificate error | Ports 80/443 aren't open in the security group. Check with `sudo journalctl -u caddy -n 50` |
| `/health` shows `"chain":false` | `pm2 logs validator` |
| `next build` runs out of memory | Use a bigger instance (the script already adds 4 GB swap) |
| AI checks don't run | Check that `apps/api/.env` has `NVIDIA_API_KEY=...`, then `pm2 restart api` |
| You stopped/started the instance and the IP changed | Attach an Elastic IP, then rerun `setup.sh` |

## Later: S3 for uploads (optional)
Uploads are stored on the instance disk by default. To use S3, create a bucket and an IAM access key,
then add the following to `apps/api/.env` and run `pm2 restart api`:
```
STORAGE_DRIVER=s3
S3_BUCKET=<bucket>
S3_REGION=<region, e.g. eu-central-1>
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```
