# Hackathon demonstration

The live homepage's [hackathon section](https://13-61-207-211.sslip.io/#hackathon) publishes a recorded run through the real API, private R2 uploads, sandbox validators, NVIDIA assistant and existing private-validator mock-USDC program. These are operator-created demonstration identities; they do not represent five independent customers or NASA participation.

## Recorded result

- Company: **Orbital Vision Lab (demo company)**.
- Five scoped sellers/agents: Giorgi, Nika, Mariam, Ana and Luka.
- Six real photograph submissions; **five accepted unique photographs**, **one cross-seller duplicate**, zero pending and zero remaining. Each seller owns its submission record; original photo rights remain with their source.
- Nika's first submission repeated Giorgi's exact bytes. The coordinator excluded it; a replacement supplied a distinct photograph. The demo buyer downloaded the consented images and approved the five distinct contributions.
- The frozen allocation records 500 mock USDC gross, 100 per contributor. **No seller payout is claimed by this run.** Settlement functionality was separately exercised end to end in the release tests. Parent escrow cannot distribute directly; explicit buyer preparation and funding of designated contributor escrows is the implemented settlement path.
- A live NVIDIA company-assistant response and Nika's NVIDIA-backed corrective proposal were recorded. Earlier requests encountered temporary provider capacity errors; successful outputs are shown without inventing a response. Nika's model text imprecisely described a duplicate as accepted; the authoritative coordinator excluded it. AI text does not control acceptance or financial state.
- The combined catalog dataset passed L3: five readable distinct images at the stated resolution; all five sampled images were relevant according to the configured NVIDIA review. The 95% Wilson relevance interval is 56.55–100%, not a guarantee of quality or provenance.
- Two **different** ONNX color classifiers passed L2 static inspection and were published. Neither is represented as a space-photo classifier; no benchmark or real-world accuracy is claimed.

## Public examples

- [Five-image dataset](https://13-61-207-211.sslip.io/listings/31fa1848-5287-49b2-b370-77d65b5c4c54).
- [Red/blue ONNX classifier](https://13-61-207-211.sslip.io/listings/a2ace96b-f591-431b-b2b7-f60ad4fe9cac).
- [Color-dominance ONNX baseline](https://13-61-207-211.sslip.io/listings/5f7907af-1a0a-4254-a819-b87841a4a23b).
- [Company order](https://13-61-207-211.sslip.io/orders/1ddb90e8-cd3d-4cb3-9901-e58a1676f220), with participant authentication required for the private workspace.
- [Public evidence snapshot](https://13-61-207-211.sslip.io/hackathon-evidence.json), containing only this demo's reports, hashes, public identities, source credits, shared events and allocation.

## Reproduce or resume

From the repository root, with Python dependencies installed:

```powershell
.venv\Scripts\python.exe scripts/prepare-hackathon.py
npx tsx scripts/hackathon-demo.ts
```

The preparation downloads five pinned NASA images with attribution and builds two deterministic ONNX models. The live script uses wallet sign-in, test faucet, paid storage and verification invoices, private multipart uploads, real funded requests, explicit review consent, buyer approval and publication. It never writes fake completed jobs or contribution counters into the database. It refuses known public mainnet/devnet genesis hashes and uses the fixed demo deployment.

Private actor keys and resumable step state stay under ignored `.data/hackathon/private-state.json`. Never commit or serve that file. Re-running resumes the same accounts, assets and completed actions; removing state would create another set of accounts and is not a reset of the existing run. Account aliases are unique. The evidence snapshot intentionally contains a fixed recorded timestamp rather than pretending to be live shared state.

`npx tsx scripts/hackathon-demo.ts --publish` additionally writes the allowlisted evidence to the frontend's imported data and public JSON after a sensitive-field scan. Review those files before committing and rebuilding. No credentials, session tokens, object keys or signed download URLs belong in them. Public source thumbnails come from NASA rather than publishing private R2 delivery links.

Photographs are credited to NASA and the named photographers, with original sources and [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). This is informational demonstration use, not NASA endorsement, proprietary imagery, an exclusive license, or a proof of legal ownership. Automated checks do not establish that an arbitrary photo is authentic or not AI-generated.

## Completion limits

The core opt-in collaboration MVP in the supplied brief is implemented, deployed and tested: scoped agents, claims/proposals, trusted evidence, exact/near duplicate handling, buyer review, durable SSE, immutable accounting and existing-contract contributor settlement. The large three-seller 10,000-image scenario remains a reproducible deterministic fixture; this public run uses five actual images to demonstrate the real upload pipeline honestly.

The current review/final-bundle UI uses individual image files; archive-member extraction-to-review mapping remains a workflow extension. Unbounded load, independent production audit, production signer/legal approvals and Mainnet are not completed or claimed. The original brief explicitly prohibited mainnet and real payments.
