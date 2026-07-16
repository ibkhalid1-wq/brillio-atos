#!/bin/bash
# Brillio ATOS — Azure Static Web App Deploy
#
# Replaces the Container App approach entirely.
# No Docker, no ACR, no Container App Environments.
#
# What it does:
#   1. Builds the Vite SPA locally (reads VITE_* from .env.local)
#   2. Creates an Azure Static Web App (if not already existing)
#   3. Deploys dist/ using the SWA CLI
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Node.js 22+ available
#   - npm install has been run at least once

set -e

RESOURCE_GROUP="brillio-atos-rg"
SWA_NAME="brillio-atos-web"
LOCATION="eastus2"   # Static Web Apps available regions: centralus, eastus2, westus2, westeurope, eastasia

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "=========================================="
echo "Brillio ATOS — Static Web App Deploy"
echo "=========================================="
echo ""

# ── Pre-flight ────────────────────────────────────────────────────────────────
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found."
    exit 1
fi
if ! az account show > /dev/null 2>&1; then
    echo "❌ Not logged in to Azure. Run: az login"
    exit 1
fi

# ── Auto-load .env.local ──────────────────────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env.local"
if [ ! -f "$ENV_FILE" ]; then
    ENV_FILE="$PROJECT_ROOT/.env"
fi

if [ -f "$ENV_FILE" ]; then
    echo "Loading env from $ENV_FILE ..."
    while IFS='=' read -r key value; do
        [[ -z "$key" || "${key:0:1}" == "#" ]] && continue
        [[ "$key" != VITE_* ]] && continue
        value="${value%%[[:space:]]*#*}"
        value="${value%\"}" ; value="${value#\"}"
        value="${value%\'}" ; value="${value#\'}"
        export "$key=$value"
    done < "$ENV_FILE"
    echo "✓ Env loaded"
fi

# Warn if placeholders (don't block — app works in local-only mode)
if [[ "${VITE_SUPABASE_URL:-}" == *"your-project-ref"* ]]; then
    echo "⚠️  Supabase URL is placeholder — app will run in local-only mode."
    VITE_SUPABASE_URL=""
fi
if [[ "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" == *"your-"* ]]; then
    VITE_SUPABASE_PUBLISHABLE_KEY=""
fi
echo ""

# ── Build ─────────────────────────────────────────────────────────────────────
echo "Building Vite SPA..."
cd "$PROJECT_ROOT"

# Set env vars for the build
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}"
export VITE_SUPABASE_PUBLISHABLE_KEY="${VITE_SUPABASE_PUBLISHABLE_KEY:-}"
export VITE_SUPABASE_PROJECT_ID="${VITE_SUPABASE_PROJECT_ID:-}"

# Use the project's own Node (handles ~/tools/node/bin path)
export PATH="$HOME/tools/node/bin:$PATH"

# Install deps if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

npm run build
echo "✓ Build complete → dist/"
echo ""

# ── Ensure resource group exists ──────────────────────────────────────────────
if ! az group exists --name "$RESOURCE_GROUP" | grep -q true; then
    echo "Creating resource group $RESOURCE_GROUP in $LOCATION..."
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION" > /dev/null
    echo "✓ Resource group created"
fi

# ── Create Static Web App (idempotent) ───────────────────────────────────────
echo "Ensuring Static Web App '$SWA_NAME' exists..."
EXISTING=$(az staticwebapp list \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?name=='$SWA_NAME'].name" \
    -o tsv 2>/dev/null || echo "")

if [ -z "$EXISTING" ]; then
    az staticwebapp create \
        --name "$SWA_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --location "$LOCATION" \
        --sku Free \
        --output none
    echo "✓ Static Web App created"
else
    echo "✓ Static Web App already exists"
fi

# ── Get deployment token ──────────────────────────────────────────────────────
echo "Fetching deployment token..."
DEPLOY_TOKEN=$(az staticwebapp secrets list \
    --name "$SWA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.apiKey" \
    -o tsv)

# ── Install SWA CLI if needed and deploy ─────────────────────────────────────
echo "Deploying dist/ to Static Web App..."
npx --yes @azure/static-web-apps-cli deploy "$PROJECT_ROOT/dist" \
    --deployment-token "$DEPLOY_TOKEN" \
    --env production

echo ""
echo "=========================================="
echo "Deploy Complete! ✅"
echo "=========================================="
echo ""

APP_URL=$(az staticwebapp show \
    --name "$SWA_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "defaultHostname" \
    -o tsv)

echo "🌐  Brillio ATOS is live at: https://${APP_URL}"
echo ""
echo "To redeploy after code changes, just run this script again."
echo "To tear down: az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo ""
