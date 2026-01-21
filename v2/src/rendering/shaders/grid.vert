#version 300 es
precision mediump float;

in vec2 a_position;
uniform mat3 u_transform_scale; // Scale-only transform (no translation)

out vec2 v_local_coord; // Coordinate relative to view center

void main() {
    // Inverse maps clip space (-1..1) to local data space (centered at 0)
    v_local_coord = (inverse(u_transform_scale) * vec3(a_position, 1.0)).xy;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
