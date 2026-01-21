console.log('Main script loading... (v2)');

async function init() {
    try {
        console.log('Attempting to import ScatterGL...');
        const { ScatterGL } = await import('./src/core/scatter_gl');
        console.log('ScatterGL imported successfully');

        const container = document.getElementById('container') as HTMLElement;
        if (!container) {
            console.error('Container not found!');
            return;
        }
        
        console.log('Container found, initializing plot...');
        const plot = new ScatterGL(container);
        
        // Load data (stubbed)
        plot.load('tiles/')
            .then(() => console.log('Initial load request complete'))
            .catch(e => console.error('Initial load request failed', e));

        // @ts-ignore
        window.plot = plot;

        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            const updateTheme = () => {
                const isDarkMode = appContainer.classList.contains('dark-mode');
                // The renderer is not directly accessible from the plot object.
                // This is a limitation of the current structure.
                // As a workaround, I will access the private renderer property.
                // A better solution would be to expose a method on ScatterGL to set the theme.
                // @ts-ignore
                const renderer = plot.renderer;
                if (renderer) {
                    if (isDarkMode) {
                        renderer.setClearColor(0.066, 0.066, 0.066, 1);
                        renderer.setGridColor(0.9, 0.9, 0.9, 0.2);
                    } else {
                        renderer.setClearColor(1, 1, 1, 1);
                        renderer.setGridColor(0.2, 0.2, 0.2, 0.5);
                    }
                    plot.render();
                }
            };

            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        updateTheme();
                    }
                }
            });

            observer.observe(appContainer, { attributes: true });
            updateTheme(); // Initial theme setup
        }

    } catch (e) {
        console.error('Failed to initialize application:', e);
    }
}

init();
