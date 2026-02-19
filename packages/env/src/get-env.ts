type GetEnvOptions = {
  fallback?: string;
  required?: boolean;
};

export function getEnv(name: string, options: GetEnvOptions = {}): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    return value;
  }

  if (options.required) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return options.fallback ?? "";
}
