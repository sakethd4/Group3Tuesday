release: flask --app wsgi:app init-db --seed
web: gunicorn wsgi:app --bind 0.0.0.0:$PORT --access-logfile - --error-logfile -
