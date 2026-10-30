# Sneakfall

A small, phone-friendly arcade game about timing and close calls. No downloads, dependencies, or build step are required.

## Play

- Hold the left or right half of the game or control pad to move. Slide between halves to change direction.
- Lift your finger to stop and cloak for a moment. The cloak recharges in 3 seconds.
- Dodge falling debris. Survive for points and earn a bonus for close calls. One hit ends the run.
- Use the pause button for a break and the sound button for optional audio. Your best score is saved in your browser.

Keyboard: use the arrow keys or A/D to move, release to cloak, and P or Escape to pause.

## Local preview

From this directory, run:

```sh
python -m http.server 8000
```

Open `http://localhost:8000` in your browser.

## GitHub Pages

In the repository's **Settings → Pages**, choose **Deploy from a branch**, then select the `main` branch and `/ (root)` folder. The site uses relative asset links and works from a project path such as `/sneakfall/`.

The source is plain HTML, CSS, JavaScript, and SVG. The empty `.nojekyll` file serves it directly without Jekyll processing.
