#!/usr/bin/env bash

gcc -v || ln -s $(which gcc-4.8) /usr/bin/gcc
gcc -v || exit 1

orientdb="orientdb-community-2.2.8"
wget "http://orientdb.com/download.php?email=unknown@unknown.com&file=${orientdb}.tar.gz&os=linux" -O ${orientdb}.tar.gz

tar xzf "${orientdb}.tar.gz"
cd ${orientdb}
sed -i"" -e 's/<users>/<users><user resources="*" password="vipabc" name="root"\/>/g' config/orientdb-server-config.xml
cat config/orientdb-server-config.xml
./bin/server.sh &
sleep 2
curl -X POST http://root:vipabc@localhost:2480/database/leaf-orient-test/plocal
cd ..
