# Storage Folder

This folder is runtime data. Do not treat it as source code.

The app creates:

```text
storage/cv-batches/<batch-id>/originals/
storage/cv-batches/<batch-id>/results.json
storage/cv-batches/<batch-id>/cv-extraction-<timestamp>.xlsx
storage/cache/cv-extractions/<hash>.json
```

Uploaded CVs and generated Excel files may contain private candidate data.
Do not commit or share these files unless the user explicitly asks.
