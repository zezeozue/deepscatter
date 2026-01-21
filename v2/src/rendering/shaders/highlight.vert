#version 300 es
precision highp float;

in vec2 position;

uniform vec2 u_resolution;
uniform float u_k;
uniform vec2 u_t;
uniform float u_k_min;

void main() {
  vec2 screen_pos = position * u_k + u_t;
  
  // screen (0..w, 0..h) to clip (-1..1, 1..-1)
  vec2 clip_pos = (screen_pos / u_resolution) * 2.0 - 1.0;
  clip_pos.y *= -1.0;

  gl_Position = vec4(clip_pos, 0.0, 1.0);
  
  // Match point.vert logic + padding
  float ratio = u_k / max(u_k_min, 0.00001);
  float size = clamp(ratio * 4.0, 2.0, 20.0);
  gl_PointSize = size + 10.0;
}
