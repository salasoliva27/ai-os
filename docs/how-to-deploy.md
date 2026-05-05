# How to deploy a product (dev → UAT → prod)

Run via deploy agent (agents/core/deploy.md).

Pre-deploy checklist:
- [ ] Tag current working state
- [ ] All visual changes verified by ux agent
- [ ] No drift detected in prod (if exists)
- [ ] Legal flags resolved for this product

UAT: bash /workspaces/agent-os-dev/scripts/bundle.sh [product] uat
Prod: bash /workspaces/agent-os-dev/scripts/bundle.sh [product] prod

After deploy: update projects/[env]/[product].md, tag all repos.
