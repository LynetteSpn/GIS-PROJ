import http.server
import ssl
import socketserver
import os

# --- Configuration ---
PORT = 8000
SERVER_ADDRESS = "0.0.0.0" # Listen on all interfaces (IPv4)
CERT_FILE = "certificate.crt"
KEY_FILE = "private.key"

# -----------------------------------------------------
# 1. Custom HTTPS Server Setup
# -----------------------------------------------------

class SecureSimpleHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    # This class handles requests just like the simple http.server
    pass

def start_secure_server(port, certfile, keyfile):
    if not os.path.exists(certfile) or not os.path.exists(keyfile):
        print("FATAL ERROR: Certificate or Key file not found.")
        print(f"Please ensure '{certfile}' and '{keyfile}' are in the current directory.")
        return

    try:
        # Create a basic SSLContext
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        
        # Load the certificate and private key files
        context.load_cert_chain(certfile=certfile, keyfile=keyfile)
        
        # Create the standard server. It will use AF_INET (IPv4) by default.
        server = socketserver.TCPServer((SERVER_ADDRESS, port), SecureSimpleHTTPRequestHandler)
        
        # Apply the SSL context to the server's socket
        server.socket = context.wrap_socket(server.socket)

        print("-" * 40)
        print("HTTPS Server successfully configured.")
        print(f"SECURE SERVER RUNNING AT: https://{SERVER_ADDRESS}:{port}/")
        print(f"Access via your mobile at: https://10.1.4.18:{port}/")
        print("Remember to accept the self-signed certificate warning on your mobile.")
        print("-" * 40)
        
        server.serve_forever()

    except ssl.SSLError as e:
        print(f"\nFATAL SSL ERROR: {e}")
        print("This often means the key and certificate files are corrupted or incorrect.")
    except Exception as e:
        print(f"\nANOTHER ERROR OCCURRED: {e}")
        
# -----------------------------------------------------
# 2. Execution
# -----------------------------------------------------
if __name__ == '__main__':
    start_secure_server(PORT, CERT_FILE, KEY_FILE)