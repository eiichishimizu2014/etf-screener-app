# ---- React ビルド ----
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src/App.jsx src/main.jsx ./src/
RUN npm run build

# ---- Python API ----
FROM python:3.12-slim
WORKDIR /app
COPY requirements-api.txt ./
RUN pip install --no-cache-dir -r requirements-api.txt
COPY --from=frontend /app/dist ./dist
COPY server.py ./
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-10000}"]
