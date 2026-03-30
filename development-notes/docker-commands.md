# Docker commands

These commands are based on the root `Dockerfile` and `docker-compose.yml`.

Run them from the repository root: `/home/alex/projects/job-ops`

## Pull and run the published image

If you want the closest equivalent to `docker compose up -d`:

```bash
docker pull ghcr.io/dakheera47/job-ops:latest

docker run -d \
  --name job-ops \
  -p 3005:3001 \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e PYTHON_PATH=/usr/bin/python3 \
  --env-file /home/alex/projects/job-ops/.env \
  -v /home/alex/projects/job-ops/data:/app/data \
  --restart unless-stopped \
  ghcr.io/dakheera47/job-ops:latest
```

If you do not want to load `.env`, remove the `--env-file ...` line.

Open the app at `http://localhost:3005`

## Build locally and run

```bash
docker build -t job-ops-local /home/alex/projects/job-ops

docker run -d \
  --name job-ops-local \
  -p 3005:3001 \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e PYTHON_PATH=/usr/bin/python3 \
  --env-file /home/alex/projects/job-ops/.env \
  -v /home/alex/projects/job-ops/data:/app/data \
  --restart unless-stopped \
  job-ops-local
```

## Useful follow-up commands

```bash
docker logs -f job-ops
docker stop job-ops
docker rm job-ops
docker ps
```
