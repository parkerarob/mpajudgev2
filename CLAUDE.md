
## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## Deploy Configuration (configured by /setup-deploy)
- Platform: Firebase Hosting
- Production URL: https://mpa-judge-v2.web.app
- Deploy workflow: auto-deploy on push to main (.github/workflows/firebase-hosting-merge.yml)
- PR preview workflow: .github/workflows/firebase-hosting-pull-request.yml
- Firebase project: mpa-judge-v2
- Merge method: squash (solo repo, keep history clean)
- Project type: web app (SPA, no build step)
- Post-deploy health check: https://mpa-judge-v2.web.app/version.json

### Custom deploy hooks
- Pre-merge: npm run test:unit && npm run test:security
- Deploy trigger: automatic on push to main (GitHub Actions)
- Deploy status: firebase hosting:channel:list --project mpa-judge-v2
- Health check: curl -sf https://mpa-judge-v2.web.app/version.json
