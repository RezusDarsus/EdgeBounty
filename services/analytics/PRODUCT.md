# Developer analytics

Platform: web. Primary user: EdgeBounty's developer/operator checking current activity, registrations, feature usage, and revenue/accounting. The user requested a dashboard independent of the public site and confirmed both activity and revenue.

Separate Node service, private password-protected hostname, no marketplace navigation or wallet requirement. Inherit EdgeBounty's Night Ledger colors and clear financial typography. Responsive desktop/mobile overview with four sections: presence, registrations, feature usage, accounting. Financial figures must distinguish settled commission, seller proceeds, service receipts and prepaid credit receipts. Current deployment uses mock USDC with no monetary value.

Implementation defaults: active means a visible-browser heartbeat within five minutes; activity windows are UTC calendar days. Visitor counts estimate browsers, not people, and exclude opted-out browsers. Count accounts from persisted registration records, including disclosed operator/demo identities. Never invent historical browser activity. Hash visitor/account telemetry, omit IPs, wallets, queries and prompts, retain telemetry for 30 days. All-time financial/account totals come from read-only aggregate queries. Keep an explicit unavailable state when marketplace data cannot be read.
