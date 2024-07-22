#!/bin/sh

set -e

sed -i "s/__DB_DATABASE__/${DB_DATABASE}/g" /etc/odbc.ini
sed -i "s/__DB_USER__/${DB_USER}/g" /etc/odbc.ini
sed -i "s/__DB_PASSWORD__/${DB_PASSWORD}/g" /etc/odbc.ini
sed -i "s/__DB_SERVER__/${DB_SERVER}/g" /etc/odbc.ini
sed -i "s/__DB_PORT__/${DB_PORT}/g" /etc/odbc.ini

sed -i "s/__DB_SERVER__/${DB_SERVER}/g" /opt/IBM/informix/4.10/etc/sqlhosts
sed -i "s/__DB_HOST__/${DB_HOST}/g" /opt/IBM/informix/4.10/etc/sqlhosts
sed -i "s/__DB_PORT__/${DB_PORT}/g" /opt/IBM/informix/4.10/etc/sqlhosts