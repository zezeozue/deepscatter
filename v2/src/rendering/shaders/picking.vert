#version 300 es
precision mediump float;

in vec2 position;
in vec4 v_color;
uniform float u_k;
uniform vec2 u_t;
uniform vec2 u_resolution;
uniform float u_k_min;

out vec4 out_v_color;

void main() {
    out_v_color = v_color;
    vec2 pos = (position * u_k) + u_t;
    pos = pos / u_resolution * 2.0 - 1.0;
    pos.y *= -1.0;

    gl_Position = vec4(pos, 0, 1);
    
    // Match point.vert logic but slightly larger for easy picking
    float ratio = u_k / max(u_k_min, 0.00001);
    gl_PointSize = max(5.0, clamp(ratio * 4.0, 2.0, 20.0));
}
