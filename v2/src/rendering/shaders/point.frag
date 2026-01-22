#version 300 es
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  // If alpha is 0, discard the point (filtered out)
  if (vColor.a < 0.01) {
    discard;
  }
  
  vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
  float distSq = dot(circCoord, circCoord);
  if (distSq > 1.0) {
    discard;
  }
  
  // Anti-alias the edge - make the transition sharper
  float alpha = 1.0 - smoothstep(0.98, 1.0, distSq);

  // Additive blending for density effect
  // We can't actually do additive blending without changing blendFunc
  // but we can simulate it with a lower alpha. Increased from 0.7 to 0.85
  fragColor = vec4(vColor.rgb, alpha * 0.85 * vColor.a);
}
