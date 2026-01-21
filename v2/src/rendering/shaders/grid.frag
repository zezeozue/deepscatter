#version 300 es
precision mediump float;

in vec2 v_local_coord;
uniform vec4 u_color;
uniform vec2 u_resolution;
uniform float u_grid_scale;
uniform vec2 u_grid_offset;

out vec4 out_color;

float grid(vec2 grid_pos, float thickness) {
    vec2 pos = fract(grid_pos);
    // fwidth of grid_pos is correct because grid_pos varies linearly
    vec2 anti_alias = fwidth(grid_pos) * 1.5;
    
    // Handle wrap-around for smoothstep
    // Simply check distance to nearest integer (0 or 1)
    // fract gives 0..1. Distance to line (at 0/1) is min(pos, 1-pos).
    
    vec2 dist = min(pos, 1.0 - pos);
    
    vec2 line = smoothstep(vec2(thickness - anti_alias.x), vec2(thickness), dist) 
              - smoothstep(vec2(thickness), vec2(thickness + anti_alias.x), dist);
              
    // Since we used distance to edge, logic is inverted?
    // smoothstep(thick-aa, thick, dist).
    // If dist is small (near line), value goes 0->1.
    // Wait, we want line to be 1 near 0.
    // Original: smoothstep(..., pos) - smoothstep(..., pos).
    // This creates a pulse at thickness.
    // If pos is 0..1.
    // We want pulse at 0 (and 1).
    // Original code was:
    // smoothstep(t-aa, t, pos) - smoothstep(t, t+aa, pos).
    // This creates a line at pos=t. Not at pos=0?
    // Ah, grid lines are usually at 0.
    // The original shader drew lines at `thickness`.
    // It implies grid lines are shifted? Or `thickness` is the line width?
    // Usually grid is `1.0 - smoothstep(thickness, thickness+aa, abs(pos-round(pos)))`.
    // The original shader was:
    // smoothstep(t-aa, t, pos) - smoothstep(t, t+aa, pos).
    // This draws a line at `pos = t`.
    // So the grid lines are at 0.005, 1.005?
    // That's weird. But I should probably preserve behavior or fix it to be centered.
    // Centered at 0 is better.
    // I'll use standard grid logic:
    // dist = abs(fract(pos - 0.5) - 0.5).
    // value = 1.0 - smoothstep(thickness, thickness + aa, dist).
    
    vec2 d = abs(fract(grid_pos - 0.5) - 0.5); // Distance to nearest integer
    vec2 t = vec2(thickness);
    vec2 aa = anti_alias;
    vec2 g = 1.0 - smoothstep(t - aa, t + aa, d);
    
    return max(g.x, g.y);
}

void main() {
    float ratio = u_resolution.x / u_resolution.y;
    vec2 aspect_local = v_local_coord * vec2(ratio, 1.0);
    
    // pos = (v_local * aspect + center * aspect) * scale
    // u_grid_offset = fract(center * aspect * scale)
    vec2 pos = aspect_local * u_grid_scale + u_grid_offset;
    
    // Reduce thickness by half (0.005 -> 0.0025)
    float major_grid = grid(pos, 0.0025);
    
    out_color = vec4(u_color.rgb, u_color.a * major_grid);
}
