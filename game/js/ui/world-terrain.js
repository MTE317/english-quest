// Draw the original atlas at low resolution so each terrain detail is a real pixel.
const WIDTH = 240;
const HEIGHT = 260;

function grain(x, y) {
  const bits = Math.imul(x + 23, 374761393) ^ Math.imul(y + 17, 668265263);
  return ((bits ^ (bits >>> 13)) >>> 0) % 997 / 997;
}

function noise(x, y, size) {
  const left = Math.floor(x / size);
  const top = Math.floor(y / size);
  const u = x / size - left;
  const v = y / size - top;
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(mix(grain(left, top), grain(left + 1, top), u),
    mix(grain(left, top + 1), grain(left + 1, top + 1), u), v);
}

let terrain;
function makeTerrain() {
  const colors = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const bend = 18 * Math.sin(y / 35);
      const continent = 1 - Math.hypot((x - 121 - bend) / 87, (y - 132) / 102);
      const island = 1 - Math.hypot((x - 189) / 23, (y - 91) / 34);
      const coast = Math.max(continent, island) + (noise(x, y, 19) - 0.5) * 0.52
        + (noise(x, y, 7) - 0.5) * 0.18;
      const texture = grain(x, y);
      const wave = y % 9 === Math.floor(x / 11) % 9 && grain(Math.floor(x / 9), y) > 0.76;
      const ridge = noise(x + 481, y + 106, 19) * 0.8 + noise(x, y, 5) * 0.2;
      if (coast < -0.09) colors.push(wave ? '#386274' : texture > 0.96 ? '#315668' : '#25495e');
      else if (coast < 0) colors.push(texture > 0.77 ? '#729a90' : '#467584');
      else if (coast < 0.065) colors.push(texture > 0.6 ? '#e2c58c' : '#b9a877');
      else if (ridge > 0.67) colors.push(ridge > 0.76 ? '#c1c4ad' : texture > 0.5 ? '#898e7c' : '#707963');
      else if (noise(x + 821, y + 453, 14) > 0.53) colors.push(texture > 0.72 ? '#769359' : '#466b4d');
      else colors.push(texture > 0.76 ? '#a3ac70' : '#88995e');
    }
  }
  return colors;
}

export function drawWorldTerrain(canvas, regions) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  terrain ??= makeTerrain();

  const centers = regions.map(({ x, y }) => [x * WIDTH / 100, y * HEIGHT / 100]);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const cloud = noise(x + 51, y + 122, 21);
      const distance = Math.min(...centers.map(([cx, cy]) => Math.hypot(x - cx, y - cy)));
      const fade = (distance - 42 + cloud * 12) / 12;
      const obscured = fade > grain(x, y);
      ctx.fillStyle = obscured
        ? cloud > 0.62 ? '#24354a' : cloud > 0.37 ? '#1e2d42' : '#17253a'
        : terrain[y * WIDTH + x];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}
