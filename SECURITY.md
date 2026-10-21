# Security

This repository holds public on-chain addresses and open-source tooling. It never holds private keys, API keys or user data.

- **Wrong or malicious data** (an address that points to an impostor contract, a launchpad entry that is a clone) is the main risk. Report it by opening an issue with the `security` label, or privately to the maintainers listed in CODEOWNERS, and we will fix the entry and cut a patch release.
- **Detector / scripts:** they only read from RPC endpoints and post to webhooks you configure. Report code vulnerabilities privately first.
- Never trust an entry blindly before trading: `status` and `checked` tell you when it was last verified, and `sources` shows where the data came from.
