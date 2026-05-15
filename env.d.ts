declare module "bun" {
  interface Env {
    GROQ_API_KEY: string;

    NEXTCLOUD_URL: string;
    NEXTCLOUD_USERNAME: string;
    NEXTCLOUD_PASSWORD: string;
  }
}
