# Glaze Blog Example

A simple blog example using Glaze CMS.

## Setup

1. **Install dependencies** (from root):

   ```bash
   bun install
   ```

2. **Create PostgreSQL database**:

   ```bash
   createdb glaze_blog
   ```

3. **Configure environment**:

   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

4. **Run development server**:

   ```bash
   cd examples/blog
   bun dev
   ```

5. **Test the endpoints**:

   ```bash
   # Health check
   curl http://localhost:4000/api/health

   # Readiness check
   curl http://localhost:4000/api/ready
   ```

## Schema

The example includes a simple `posts` table with:

- `id` - Primary key
- `title` - Post title
- `slug` - URL-friendly slug
- `content` - Post content
- `status` - Draft/published status
- `createdAt` - Creation timestamp
- `updatedAt` - Last update timestamp

See `src/schema.ts` for the full schema definition.
