#version 300 es
precision highp float;

uniform vec4 u_color;
out vec4 fragColor;

void main() {
  vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
  float distSq = dot(circCoord, circCoord);
  
  // Ring: discard outside (1.0) and inside (0.6)
  if (distSq > 1.0 || distSq < 0.6) {
    discard;
  }
  
  fragColor = u_color;
}
