/** @type {import('next').NextConfig} */
const nextConfig = {
  // @releve/core est distribué en TypeScript brut (main = src/index.ts) : Next
  // doit le transpiler comme s'il faisait partie de l'app.
  transpilePackages: ["@releve/core"],
};

export default nextConfig;
