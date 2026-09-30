# MAM local accounts

Accounts are saved in this browser's local storage. Passwords are stored as salted PBKDF2 hashes, not as plain text. No email confirmation or external account service is used.

Run the site from the same browser and origin each time so it can access the saved accounts. For example, serve this folder with `python3 -m http.server 8000` and open `http://localhost:8000`.

These demo accounts do not sync across browsers or devices. Because account data is stored in the browser, this is not suitable for production authentication or sensitive accounts.