# stockweb

A real-time Taiwan stock dashboard with intraday price charts and order book.

## Features

- Real-time quotes, five-level order book, and key stats (open, high, low, volume)
- Intraday line chart for the current session (09:00–13:30, Taipei time)
- Price change and colors based on the previous day's close
- Taiwan market color scheme toggle (red up / green down)
- Auto-refresh during trading hours; single fetch after market close with a closed-market indicator
- Default stock: `0050`

## Requirements

- Python 3.14+
- [uv](https://docs.astral.sh/uv/) (recommended)

## Local development

```bash
git clone <your-repo-url>
cd stockweb

uv sync
uv run python main.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000).

Enable Flask debug mode:

```bash
# PowerShell
$env:FLASK_DEBUG="true"; uv run python main.py
```

## Docker

```bash
docker build -t stockweb .
docker run --rm -p 8080:8080 stockweb
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

## Deploy to Google Cloud Run

No local Google Cloud SDK required. Push this repository to GitHub, then:

1. Open [Google Cloud Console → Cloud Run](https://console.cloud.google.com/run)
2. **Create Service** → **Continuously deploy from a repository**
3. Connect GitHub and select this repository
4. Build type: **Dockerfile**
5. Region: `asia-east1` (recommended)
6. Authentication: **Allow unauthenticated invocations**
7. Memory: 512 MiB · Request timeout: 120 seconds

Cloud Run sets `PORT=8080`; the container starts `gunicorn` automatically.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /` | Web UI |
| `GET /api/stock?code=0050` | Real-time stock data |
| `GET /api/chart?code=0050` | Intraday chart data |
| `GET /api/search?q=50`     | Search stock |

## Project structure

```
stockweb/
├── main.py           # Flask app and API routes
├── templates/        # HTML templates
├── static/           # CSS and client-side JavaScript
├── util/             # Backend Utility
├── Dockerfile
├── requirements.txt  # Generated via: uv export --format requirements-txt --no-hashes -o requirements.txt
└── pyproject.toml
```

## Update dependencies

```bash
uv add <package>
uv export --format requirements-txt --no-hashes -o requirements.txt
```

## License

[MIT](LICENSE)
