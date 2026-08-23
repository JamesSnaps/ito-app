FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

# gunicorn rather than Flask's dev server: this is reachable from a domain,
# not just the living room.
#
# Exactly ONE worker, on purpose. Rooms live in a per-process dict, so a
# second worker would serve some requests from a process that has never
# heard of your room — players would see 404s at random. Concurrency comes
# from threads instead, which share that memory. Scaling past one process
# means moving room state to Redis or a file first.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", \
     "--access-logfile", "-", "app:app"]
