import os

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase_client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)
