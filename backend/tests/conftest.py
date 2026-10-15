import os
import tempfile

# Must run before the app is imported anywhere.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "t.db").replace("\\", "/")
os.environ["STATIC_DIR"] = os.path.join(_tmp, "nostatic")
os.environ["ADMIN_EMAIL"] = "admin@test.in"
os.environ["ADMIN_PASSWORD"] = "test-password-1"
os.environ["SEED_DEMO"] = "false"
os.environ["WATSONX_APIKEY"] = ""
os.environ["WATSONX_PROJECT_ID"] = ""
