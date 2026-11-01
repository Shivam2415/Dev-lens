# Restore DevLens

This guide covers restoring DevLens from a backup ZIP or installing it directly from the public GitHub repository on Windows.

## Restore from a backup ZIP

1. Download the DevLens backup ZIP from the cloud drive where you stored it. Do not delete the cloud copy until the download finishes.
2. In File Explorer, right-click the ZIP and choose **Extract All...**. Choose the folder where you want the project restored. You can choose its original project folder or a new folder such as `%USERPROFILE%\DevLens`. If restoring over an existing folder, close editors/build processes using it first; files with matching names may be replaced. The ZIP does not include `.git`, `node_modules`, or your previous Ollama model files.
3. Open PowerShell and change to the extracted project folder. For example:

   ```powershell
   cd "$env:USERPROFILE\DevLens"
   ```

   Use the folder you selected instead if you chose a different location.
4. Run the included restore script:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore.ps1
   ```

   The script uses `winget` to install Ollama if it is missing, starts the local Ollama service if needed, and downloads the `qwen2.5:3b` model. The model download is about 1.9 GB in this setup and requires an internet connection. If `winget` is unavailable, install Ollama from <https://ollama.com/download> and run the restore script again.
5. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `dist` folder inside the extracted project.
6. If local AI reports fail with HTTP 403, add the new extension ID shown in Chrome's extension details to the user `OLLAMA_ORIGINS` environment variable and restart Ollama. Follow the Ollama setup and troubleshooting steps in [README.md](README.md#ollama-setup).

## Install from the public repository

1. Download and extract the source from [the DevLens GitHub repository](https://github.com/Shivam2415/Dev-lens) using **Code** → **Download ZIP**, or clone it:

   ```powershell
   git clone https://github.com/Shivam2415/Dev-lens.git
   cd Dev-lens
   ```

2. Install Node.js if necessary. From the project folder, install dependencies and build:

   ```powershell
   npm install
   npm run build
   ```

3. Load the generated `dist` folder in Chrome: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist`.
4. To use local AI, install Ollama from <https://ollama.com/download>, then run:

   ```powershell
   ollama pull qwen2.5:3b
   ```

   Keep Ollama running and select **Ollama (free, local)** in DevLens. Each fresh unpacked installation can have a different extension ID; if Ollama returns HTTP 403, add that installation's exact `chrome-extension://<extension-id>` origin to `OLLAMA_ORIGINS` as shown in [README.md](README.md).

## Notes

- The ZIP preserves the project source and built extension, not Chrome's saved browser data, extension storage, Git history, or downloaded Ollama model files.
- The model is downloaded separately during restore; plan for roughly 1.9 GB of disk space in addition to the project.
- To resume development after restoring, run `npm install` and then `npm run build`.
