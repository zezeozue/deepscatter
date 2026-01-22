#version 300 es
precision highp float;

in vec2 position;
in vec4 color;

uniform vec2 u_resolution;
uniform float u_k;
uniform vec2 u_t;
uniform float u_k_min; // Initial zoom level (physical)

out vec4 vColor;

void main() {
  vec2 screen_pos = position * u_k + u_t;
  
  // screen (0..w, 0..h) to clip (-1..1, 1..-1)
  vec2 clip_pos = (screen_pos / u_resolution) * 2.0 - 1.0;
  clip_pos.y *= -1.0;

  gl_Position = vec4(clip_pos, 0.0, 1.0);
  
  // Scale relative to initial zoom
  // Ensure points are visible at start (e.g. 3px) and grow
  float ratio = u_k / max(u_k_min, 0.00001);
  gl_PointSize = clamp(ratio * 4.0, 2.0, 20.0);
  
  // Handle both RGB (3 components) and RGBA (4 components)
  // If only 3 components, alpha defaults to 1.0
  vColor = color;
}
