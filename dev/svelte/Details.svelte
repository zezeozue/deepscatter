<script>
  import { onMount } from 'svelte';

  export let scatterplot = undefined;
  let metadata = {};

  onMount(() => {
    if (!scatterplot) {
      return;
    }
    scatterplot.plot.subscribe(() => {
      const data = scatterplot.plot.get();
      if (data && data.table) {
        const table = data.table;
        metadata = {
          'Trace UUID': table.trace_uuid,
          'Startup (ms)': table.startup_duration,
          'Total Points': table.total_points,
        };
      }
    });
  });
</script>

<div class="details-panel">
  <h3>Plot Details</h3>
  {#if Object.keys(metadata).length > 0}
    <ul>
      {#each Object.entries(metadata) as [key, value]}
        <li><strong>{key}:</strong> {value}</li>
      {/each}
    </ul>
  {:else}
    <p>No metadata available.</p>
  {/if}
</div>

<style>
  .details-panel {
    width: 100%;
    height: auto;
    padding: 5px;
    background-color: #ffffff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: 'Roboto Mono', monospace;
    font-size: 12px;
    overflow-y: auto;
    display: block; /* Always visible for now */
  }
  :global(a) {
    color: #1a73e8;
    text-decoration: none;
  }
  :global(a:hover) {
    text-decoration: underline;
  }
  h3 {
    margin-top: 0;
  }
  ul {
    list-style-type: none;
    padding: 0;
  }
  li {
    margin-bottom: 5px;
  }
</style>