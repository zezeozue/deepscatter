#version 300 es
precision mediump float;

in vec4 out_v_color;
out vec4 out_color;

void main() {
    out_color = out_v_color;
}
