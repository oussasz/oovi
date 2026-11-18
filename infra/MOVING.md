# Moving the cloud runner to another server

The runner keeps nothing on its server: chats, jobs and connectors live in the website's database. Moving is
"set up the new one, then remove the old one". Both can run at the same time without harm (a job is run by one
runner only: its lease is the lock).

## What you need
- A server with **Ubuntu 22.04 or 24.04**, at least **2 GB of memory**, 1 or 2 processors, 20 GB of disk.
  Intel/AMD or ARM both work. Any provider (Azure, Hetzner, OVH, DigitalOcean, Scaleway…).
- SSH access to it. No other port needs to be open: the runner only calls out.
- The **RUNNER_SECRET**: the same value as in the website's settings (keep it in your password manager; to make a
  new one: `openssl rand -hex 32`, then change it on the website too).
- If the runner's image is private on GitHub: a GitHub token with only `read:packages`
  (github.com > Settings > Developer settings > Personal access tokens). If the image is public, nothing.

## Steps
1. **Create the server** at the provider (Ubuntu 24.04). Allow SSH only, from your own IP address if the provider
   lets you choose.
2. **Copy the setup script** to it, from your computer:
   `scp infra/setup.sh USER@SERVER_IP:`
3. **Run it** on the server:
   `ssh USER@SERVER_IP`
   `sudo bash setup.sh`
   It installs Docker, the firewall, automatic security updates and image updates, then asks for:
   - the website's address (Enter keeps `https://oovi.conuron.com`),
   - RUNNER_SECRET (not shown while you type),
   - how many jobs at the same time (2 for 2 GB, 4 for 4 GB),
   - a GitHub user name and token only if the image is private.
4. **Check it**: `sudo oovi-runner status` must say `ok`. `sudo oovi-runner logs` shows what it does (job ids and
   times, never chat text).
5. **Remove the old server**:
   - Azure: `bash infra/azure/delete.sh` (asks you to type the group's name).
   - Another provider: `sudo oovi-runner uninstall` on it, then delete the server in the provider's panel.

That's all: nothing to copy, nothing to change on the website or in the apps.

## Every day use
- `sudo oovi-runner status | logs | stop | start | update | config`
- Security updates install by themselves; the server restarts at 03:30 UTC when an update needs it, and the runner
  starts again by itself. A new runner image is picked up within 6 hours (`sudo oovi-runner update` for now).
- Changing RUNNER_SECRET: change it on the website, then `sudo oovi-runner config` on every runner server.

## Azure only (infra/azure/)
- `create.sh <your IP>`: a resource group `oovi-runner-rg` with one Standard_B1ms VM (1 vCPU, 2 GiB) that runs
  setup.sh at its first start; SSH only from that IP. Then `ssh oovi@IP` and `sudo oovi-runner config`.
- `allow-ssh.sh <new IP>`: your IP changed.
- `delete.sh`: deletes the whole group (VM, disk, IP address, network). Billing stops.
