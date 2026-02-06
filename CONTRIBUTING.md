# Contributing to VOYGE.studio

Thank you for your interest in VOYGE.studio! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies with `npm install`
4. Create a feature branch from `main`
5. Make your changes
6. Run the linter with `npm run lint`
7. Build the project with `npm run build` to verify everything compiles
8. Submit a pull request

## Development

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Run the linter
npm run lint

# Build for production
npm run build
```

## Environment Variables

The project requires several API keys and configuration values. Copy `.env.example` (if available) or refer to the documentation for the required environment variables:

- Firebase configuration
- Mapbox access token
- Pexels API key
- GitHub Models / Azure AI credentials
- Supabase configuration
- Telegram Bot token

## Pull Request Guidelines

- Keep changes focused and minimal
- Write clear commit messages
- Ensure the build passes before submitting
- Describe your changes in the PR description

## Code Style

- Follow the existing code patterns in the repository
- Use TypeScript for all new files
- Use Tailwind CSS for styling
- Follow the Next.js App Router conventions

## Reporting Issues

If you find a bug or have a feature request, please open an issue on GitHub with:

- A clear description of the problem or feature
- Steps to reproduce (for bugs)
- Expected vs actual behavior (for bugs)

## License

By contributing, you agree that your contributions will be subject to the project's proprietary license.
