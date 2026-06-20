#!/usr/bin/env bash
# =============================================================================
# One-time Workload Identity Federation setup for GitHub Actions → Firebase
# Hosting deploy of noprofits.org. Keyless: no service-account JSON ever leaves
# Google. Run ONCE, on the noprofits account, against the noprofits-web project.
#
# Prereqs:
#   - gcloud authed as peter@noprofits.org on project noprofits-web
#     (purser: `gcloud config configurations activate noprofits`; if reauth is
#      needed run it interactively in this session:  ! gcloud auth login )
#   - You are an Owner/IAM admin on noprofits-web.
#
# After it prints GCP_WIF_PROVIDER and GCP_DEPLOY_SA at the end, set them as
# repo *Variables* (not secrets) — Claude can do this with `gh variable set`,
# or run the two commands echoed at the bottom yourself.
# =============================================================================
set -euo pipefail

# --- knobs -------------------------------------------------------------------
PROJECT_ID="noprofits-web"
REPO="noprofits-org/noprofits-web-engineering"   # owner/repo, case-sensitive
BRANCH="main"                                     # deploys only fire from here
POOL_ID="github-pool"
PROVIDER_ID="github-provider"
SA_NAME="gh-deploy"
# -----------------------------------------------------------------------------

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
OWNER="${REPO%%/*}"

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
echo "Project number: $PROJECT_NUMBER"

# 1) APIs. iamcredentials is REQUIRED for WIF→SA impersonation, or firebase-tools
#    fails with a misleading "have you run firebase login?".
gcloud services enable \
  firebasehosting.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  sts.googleapis.com

# 2) Deploy service account, scoped to exactly what `firebase deploy --only
#    hosting` needs and nothing more.
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="GitHub Actions — Firebase Hosting deploy" || true

# IAM is eventually consistent: `create` returns before the SA is readable, so
# the binding below can 404 with "does not exist". Poll until it resolves.
echo "Waiting for service account ${SA_EMAIL} to propagate..."
for i in $(seq 1 30); do
  if gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
    echo "  ...service account is live."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: ${SA_EMAIL} still not visible after ~60s. Re-run the script." >&2
    exit 1
  fi
  sleep 2
done

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/firebasehosting.admin" \
  --condition=None

# 3) Workload Identity pool.
gcloud iam workload-identity-pools create "$POOL_ID" \
  --location="global" \
  --display-name="GitHub Actions pool" || true

POOL_FULL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"

# 4) OIDC provider for GitHub's token issuer. The attribute-condition is the
#    real security boundary: tokens are only accepted from THIS repo, THIS
#    owner, and THIS branch ref — closing the round-3 WIF Low at the provider.
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository_owner == '${OWNER}' && assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/${BRANCH}'" \
  || true

# 5) Let ONLY this repo's federated identity impersonate the deploy SA.
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_FULL}/attribute.repository/${REPO}"

# --- outputs to wire into the repo (as Variables, not Secrets) ---------------
GCP_WIF_PROVIDER="${POOL_FULL}/providers/${PROVIDER_ID}"
echo
echo "================ DONE — set these two repo Variables ================"
echo "GCP_WIF_PROVIDER = ${GCP_WIF_PROVIDER}"
echo "GCP_DEPLOY_SA    = ${SA_EMAIL}"
echo
echo "gh variable set GCP_WIF_PROVIDER --repo ${REPO} --body \"${GCP_WIF_PROVIDER}\""
echo "gh variable set GCP_DEPLOY_SA    --repo ${REPO} --body \"${SA_EMAIL}\""
