echo "building js from typescript ..."
npm run start
echo "... built"

/usr/bin/google-chrome --allow-file-access-from-files dist/index.html