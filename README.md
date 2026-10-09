# Puyo Puyo

A single-player Puyo Puyo clone built with vanilla HTML, CSS, and JavaScript — no frameworks, no dependencies, no build step.

## Play

Just open `index.html` in any modern browser, or visit the live site (see deployment below).

## Controls

| Key | Action |
|---|---|
| Left / Right Arrow | Move pair |
| Up Arrow / X | Rotate clockwise |
| Z | Rotate counter-clockwise |
| Down Arrow | Soft drop |
| Space | Hard drop |
| P | Pause |

## How It Works

- **6×12 grid** with colored puyos that fall in pairs of two.
- **Rotate** the pair to position colors strategically.
- **Match 4 or more** same-colored puyos (connected horizontally/vertically) to pop them.
- **Chain reactions**: after a pop, remaining puyos fall under gravity. If this creates new matches, a chain bonus multiplies your score.
- **Game over** when the spawn area is blocked.

## Deploy to GitHub Pages

1. **Create a new repository** on GitHub (e.g., `puyo-puyo`).

2. **Push the files** to your repo:

   ```bash
   git init
   git add .
   git commit -m "Initial commit: Puyo Puyo game"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/puyo-puyo.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**:
   - Go to your repo on GitHub → **Settings** → **Pages**.
   - Under **Source**, select **Deploy from a branch**.
   - Choose **main** branch and **/ (root)** folder.
   - Click **Save**.

4. **Wait ~1 minute**, then visit:
   ```
   https://YOUR_USERNAME.github.io/puyo-puyo/
   ```

That's it — your game is live and anyone can play it.

## Files

| File | Description |
|---|---|
| `index.html` | Page structure |
| `style.css` | All styling |
| `game.js` | Game logic (grid, physics, chains, rendering, input) |

## License

MIT — do whatever you want with it.
