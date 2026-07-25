# AWS deployment notes

The Lambda deployment packages for this project are built from the contents of the `api/` directory.

Because `api/dns/cloudflare.py` depends on the `requests` library, the deployment package must include that dependency. Terraform uses a local packaging step to install `requests` into a temporary build directory before creating the Lambda zip archives.

## Build flow

1. Run `terraform init`.
2. Run `terraform apply`.
3. Terraform will create the Lambda zip archives under `.build/` and include the provider and DNS modules in the package.

If you want to build the archives manually, use:

```bash
mkdir -p .build/lambda-packages
python3 -m pip install --target .build/lambda-packages/requests requests
cp -r api/.build/lambda-packages
```
