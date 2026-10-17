# Sandbox image for untrusted-input analysis (SANDBOX=docker).
# The API runs it with: --network none --read-only --user 65534 --cap-drop ALL
#   --security-opt no-new-privileges --pids-limit 256 --memory/--cpus limits, tmpfs /tmp.
FROM python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY services/validator-requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
WORKDIR /app
COPY services/dataset-validator/validate.py services/dataset-validator/media.py /app/dataset-validator/
COPY services/model-validator/validate_model.py services/model-validator/infer.py /app/model-validator/
USER 65534:65534
ENTRYPOINT []
