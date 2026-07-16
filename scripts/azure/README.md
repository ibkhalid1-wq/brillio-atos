# Brillio ATOS — Azure Deployment Guide

Deploys the Vite SPA to **Azure Static Web Apps** (free tier) — no Docker, no Container Registry, no Container App Environments needed.

---

## File map

```
scripts/azure/
├── deploy-static-web-app.sh   # Single deploy script — does everything
└── README.md                  # This file
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Azure CLI | ≥ 2.55 | `brew install azure-cli` |
| Node.js | ≥ 22 | already in `~/tools/node` |

```bash
az login          # authenticate Azure CLI
az account set --subscription "YOUR_SUBSCRIPTION_NAME"
```

---

## Deploy

```bash
cd scripts/azure
chmod +x deploy-static-web-app.sh
./deploy-static-web-app.sh
```

That's it. The script:
1. Reads `VITE_*` vars automatically from `.env.local` (or `.env`) at the project root
2. Runs `npm run build` → produces `dist/`
3. Creates the `brillio-atos-rg` resource group (if not already existing)
4. Creates the `brillio-atos-web` Static Web App (if not already existing)
5. Deploys `dist/` via the SWA CLI
6. Prints the live URL

**Re-deploying after code changes:** just run the script again.

---

## Supabase config

`VITE_*` env vars are baked into the JS bundle at build time. The script reads them from `.env.local` automatically — no manual exports needed.

The app works in **local-only mode** (localStorage) if the Supabase vars are placeholder values. To enable cloud sync, set real values in `.env.local`:

```env
VITE_SUPABASE_URL=https://vudqrrqpipnkxzxslbim.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key-from-supabase-dashboard
```

> Get the anon key from Supabase Dashboard → Settings → API → `anon public`.

---

## Infrastructure overview

| Resource | Name | Region | Notes |
|----------|------|--------|-------|
| Resource Group | `brillio-atos-rg` | `eastus2` | |
| Static Web App | `brillio-atos-web` | `eastus2` | Free tier, global CDN |

Static Web Apps are available in: `centralus`, `eastus2`, `westus2`, `westeurope`, `eastasia`.

---

## Custom domain (optional)

The default URL is an Azure-generated hostname (e.g. `purple-forest-xxx.azurestaticapps.net`). To use your own domain:

```bash
az staticwebapp hostname set \
  --name brillio-atos-web \
  --resource-group brillio-atos-rg \
  --hostname atos.yourdomain.com
```

Azure will provide a CNAME/TXT record to add to your DNS provider.

---

## Supabase Edge Functions

The ATOS backend (agents, copilot, document intelligence) runs as **Supabase Edge Functions** — deployed separately:

```bash
npx --no-install supabase functions deploy <name> --project-ref vudqrrqpipnkxzxslbim
```

The Static Web App only hosts the frontend SPA; Edge Functions continue running on the Supabase project.

---

## Useful commands

```bash
# View the live URL
az staticwebapp show -n brillio-atos-web -g brillio-atos-rg --query defaultHostname -o tsv

# List all static web apps
az staticwebapp list -g brillio-atos-rg -o table

# Tear down everything
az group delete --name brillio-atos-rg --yes --no-wait
```
