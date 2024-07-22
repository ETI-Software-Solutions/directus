FROM node:18.15.0-buster-slim AS builder
ARG TARGETPLATFORM
WORKDIR /directus
COPY /dist .
RUN \
  if [ "$TARGETPLATFORM" = 'linux/arm64' ]; then \
  apt install -y \
  python3 \
  build-base \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  ; fi
RUN npm install --no-package-lock
RUN rm *.tgz

# Directus image
FROM node:18.15.0-buster-slim
ARG VERSION
ARG REPOSITORY=docker.etisoftware.com/directus
ARG INFORMIXDIR=/opt/IBM/informix/4.10
LABEL directus.version="${VERSION}"
# Default environment variables
# (see https://docs.directus.io/reference/environment-variables/)
ENV \
  DEBUG="knex:query,knex:tx,knex:bindings" \
  ADMIN_EMAIL="admin@admin.com" \
  ADMIN_PASSWORD="admin" \
  DB_SERVER="cbridge_on" \
  DB_HOST="betadb1.dev.eti.software" \
  DB_PORT=9005 \
  DB_USER="root" \
  DB_PASSWORD="3t1vr00t" \
  DB_DATABASE="cborg1000" \
  DB_CLIENT="@etisoftware/knex-informix-dialect" \
  EXTENSIONS_PATH="/directus/extensions" \
  STORAGE_LOCAL_ROOT="/directus/uploads" \
  CSDK_HOME=${INFORMIXDIR} \
  INFORMIXDIR=${INFORMIXDIR} \
  INFORMIXSERVER=cbridge_on \
  INFORMIXSQLHOSTS=${INFORMIXDIR}/etc/sqlhosts \
  LD_LIBRARY_PATH=${INFORMIXDIR}/lib:${INFORMIXDIR}/lib/esql:${INFORMIXDIR}/lib/cli
# Install required system packages
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
  msmtp \
  tzdata \
  sendmail \
  unixodbc \
  unixodbc-dev \
  libncurses5 \
  libaio1 \
  libc6 \
  wget \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir /directus && chown node:node /directus
COPY /config/odbc.ini /config/odbcinst.ini /etc
COPY /config/sqlhosts ${INFORMIXSQLHOSTS}
COPY /config/init.sh /temp/init.sh
RUN chmod 750 /temp/init.sh
# Install Informix SDK
RUN wget -O - https://etisoftware365-my.sharepoint.com/:u:/g/personal/rgoley_etisoftware_com/Ef3oltYcmndFlnhkCpAIRAUBURJkPSg2AMxoaE15kanEyQ\?e\=5cMNKo\&download\=1 | tar -x -C /temp
RUN /temp/installclientsdk -i silent -f /temp/csdk.properties -DLICENSE_ACCEPTED=TRUE
# Switch to directory '/directus'
WORKDIR /directus
# disable npm update warnings
RUN echo "update-notifier=false" >> ~/.npmrc \
  && cp /etc/odbc.ini ${HOME}/.odbc.ini
COPY --from=builder /directus .
RUN \
  # Create data directories
  mkdir -p \
    database \
    extensions \
    uploads
# Expose data directories as volumes
VOLUME \
  /directus/database \
  /directus/extensions \
  /directus/uploads
EXPOSE 8055
CMD ["sh", "-c", "/temp/init.sh && npx directus bootstrap && npx directus start"]