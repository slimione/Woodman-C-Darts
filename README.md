# Woodman C Darts Scorer

An offline, iPad-friendly 501 darts scorer for the Woodman C team.

## Publish with GitHub Pages

1. Create a new GitHub repository.
2. Upload every file in this folder to the repository root.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Open the Pages URL supplied by GitHub.

On the iPad, open that URL in Safari and use **Share → Add to Home Screen**.

## Local testing

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

Player profiles, match history and active matches are stored locally in the browser. Use **Export backup** from the app menu to move or preserve that data.
