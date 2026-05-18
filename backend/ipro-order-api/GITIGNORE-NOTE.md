# Git ignore note

Do not commit local secrets.

The backend must keep these files out of GitHub:

```txt
node_modules/
.env
*.log
.DS_Store
```

Set real values only in your deployment provider environment variables or a local `.env` file that is not committed.
