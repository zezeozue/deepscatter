# Stage 1: Build the deepscatter-ui
# Use a modern node image with GLIBC 2.38+ for duckdb compatibility
FROM node:22-trixie

# Install the build tools necessary to compile duckdb from source
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all application files
COPY . .

# Set dummy environment variables for build (required by server.mjs)
ENV DB_PATH=/tmp/dummy.db
ENV TABLE_NAME=dummy_table

# Install all dependencies. This will now compile duckdb.
RUN npm install

# Expose port 80 for Cloud Run (vite.config.ts will read PORT env var)
EXPOSE 80

# Start the development server (HMR disabled via vite.config.ts when PORT is set)
# The PORT environment variable will be set by Cloud Run
CMD ["npm", "run", "dev", "--", "--host"]