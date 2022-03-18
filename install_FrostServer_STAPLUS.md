# Install FrostServer-STAPLUS

## Java Oracle

```sh
add-apt-repository ppa:linuxuprising/java
apt install oracle-java15-installer maven
```

## Tomcat 9

```sh
apt install tomcat9 tomcat9-admin tomcat9-common tomcat9-docs
```

modif `[/usr]/lib/systemd/system/tomcat9.service` :
```sh
Environment="JAVA_HOME=/usr/lib/jvm/java-15-oracle"
```

then run
```sh
systemctl daemon-reload
```

modif `/etc/tomcat9/tomcat-users.xml`
```xml
<role rolename="manager-gui"/>
<user username="admin" password="superMotDePasse" roles="manager-gui"/>
```

```sh
systemctl restart tomcat9
```

### prevent Tomcat from writing gigatons of sh*t into logs

stop Tomcat
```sh
systemctl stop tomcat9
```

setup new directory on large drive for logs
```sh
mkdir /big/data/drive/logs/tomcat9
chmod 777 /big/data/drive/logs/tomcat9
mv /var/log/tomcat9/* /big/data/drive/logs/tomcat9/
```

```sh
mv /etc/rsyslog.d/tomcat9.conf /etc/rsyslog.d/30-tomcat9.conf
```

modif `/etc/rsyslog.d/30-tomcat9.conf`
```sh
# Send Tomcat messages to catalina.out when using systemd
$template TomcatFormat,"[%timegenerated:::date-year%-%timegenerated:::date-month%-%timegenerated:::date-day% %timegenerated:::date-hour%:%timegenerated:::date-minute%:%timegenerated:::date-second%] [%syslogseverity-text%]%msg%\n"

:programname, startswith, "tomcat9" {
  /big/data/drive/logs/tomcat9/catalina.out;TomcatFormat
  stop
}
```

```sh
systemctl restart rsyslog.service 
```

modif `/etc/tomcat9/logging.properties`
```
handlers = 1catalina.org.apache.juli.AsyncFileHandler

…

1catalina.org.apache.juli.AsyncFileHandler.level = INFO
1catalina.org.apache.juli.AsyncFileHandler.directory = /big/data/drive/logs/tomcat9

…

2localhost.org.apache.juli.AsyncFileHandler.level = INFO
2localhost.org.apache.juli.AsyncFileHandler.directory = /big/data/drive/logs/tomcat9

…

java.util.logging.ConsoleHandler.level = INFO
```

## PostgreSQL - PostGIS

```sh
apt install postgresql postgis libpostgresql-jdbc-java libpostgis-java
```

modif `/etc/postgresql/12/main/pg_hba.conf`

```sh
local   all     all     md5
```

```sh
su postgres
createuser -P admin --interactive # (superuser)
createuser -P staplus --interactive # (regular user)
createdb -O staplus -E UTF8 staplus
exit

psql -U admin -W staplus
CREATE EXTENSION postgis;
CREATE EXTENSION "uuid-ossp";
```

### link PostgreSQL libs to Tomcat

```sh
ln -s /usr/share/java/postgresql.jar /usr/share/java/postgresql-debian.jar
cd /usr/share/tomcat9/lib
ln -s ../../java/postgresql.jar .
ln -s ../../java/postgis-jdbc.jar .
```

```sh
systemctl restart tomcat9
```

## FrostServer from Fraunhofer with Plugin-PLUS

**IMPORTANT** : Plugin-PLUS requires FrostServer v2.0.0, which is not released yet at time of writing (2021-08-31). In this tutorial, branch `develop-entityEvolution` is used, but should be replaced with tag `v2.0.0` as soon as it is released.

```sh
git clone https://github.com/FraunhoferIOSB/FROST-Server
cd FROST-Server
git checkout develop-entityEvolution
```

### checkout Plugin-PLUS from SecureDimensions

```sh
cd Plugins
git clone https://github.com/securedimensions/FROST-Server-PLUS Plus
```

### configure Frost to build with Plugin-PLUS

modif `Plugins/pom.xml`, add
```xml
<module>Plus</module>
```

### adjust logging level

modif `FROST-Server.HTTP/src/main/resources/logback.xml` : replace `DEBUG` logging level with `WARN`
```xml
<logger name="de.fraunhofer.iosb.ilt.frostserver.parser.path" level="WARN"/>
<logger name="de.fraunhofer.iosb.ilt.frostserver.parser.query" level="WARN"/>
<logger name="de.fraunhofer.iosb.ilt.frostserver.persistence.pgjooq.QueryBuilder" level="WARN"/>
<logger name="org.jooq" level="WARN"/>
<logger name="io.moquette.server.netty.NettyMQTTHandler" level="WARN"/>
<logger name="io.moquette.spi" level="WARN"/>
<logger name="messageLogger" level="WARN"/>

 <root level="WARN">
    <appender-ref ref="STDOUT" />
    <appender-ref ref="FILE" />
</root>
```

### compile

```sh
JAVA_HOME=/usr/lib/jvm/java-15-oracle mvn clean install
```

tests fail, it's normal (no database yet)

compiled app: `./FROST-Server.HTTP/target/FROST-Server.HTTP-2.0.0-SNAPSHOT.war`

### deploy

go to: http://tomcatserver:port/manager/html

"Emplacement du répertoire ou fichier WAR de déploiement sur le serveur" :
 * Chemin de context (requis): `/api`
 * URL vers WAR ou répertoire: `/full/path/to/FROST-Server/FROST-Server.HTTP/target/FROST-Server.HTTP-2.0.0-SNAPSHOT.war`

click "Deploy" button

### add Plugin-PLUS JAR to the Web app

```sh
sudo cp Plugins/Plus/target/FROST-Server.Plugin.PLUS-2.0.0-SNAPSHOT.jar /var/lib/tomcat9/webapps/api/WEB-INF/lib/

sudo chown tomcat:tomcat /var/lib/tomcat9/webapps/api/WEB-INF/lib/FROST-Server.Plugin.PLUS-2.0.0-SNAPSHOT.jar

sudo chmod 640 /var/lib/tomcat9/webapps/api/WEB-INF/lib/FROST-Server.Plugin.PLUS-2.0.0-SNAPSHOT.jar
```

### configure

modif `/var/lib/tomcat9/webapps/api/WEB-INF/web.xml`

```xml
<context-param>
    <description>The base URL of the SensorThings Server without version.</description>
    <param-name>serviceRootUrl</param-name>
    <param-value>http://tomcatserver:port/api</param-value>
</context-param>
```

modif `/var/lib/tomcat9/webapps/api/META-INF/context.xml`

```xml
<Parameter override="false" name="serviceRootUrl" value="http://tomcatserver:port/api" description="The base URL of the SensorThings Server without version."/>

…

<Parameter override="false" name="plugins.plugins" value="de.securedimensions.frostserver.plugin.plus.PluginPLUS" />
<Parameter override="false" name="plugins.plus.enable" value="true" />
<Parameter override="false" name="plugins.multiDatastream.enable" value="true" />
<Parameter override="false" name="plugins.openApi.enable" value="true" />
…

<Parameter override="false" name="persistence.persistenceManagerImplementationClass" value="de.fraunhofer.iosb.ilt.frostserver.persistence.pgjooq.imp.PostgresPersistenceManagerLong"/>

…

<Parameter override="false" name="persistence.alwaysOrderbyId" value="true" description="Always add an 'orderby=id asc' to queries to ensure consistent paging."/>

…

<Parameter override="false" name="persistence.db_jndi_datasource" value="jdbc/staplus" />
<Resource
        name="jdbc/staplus" auth="Container"
        type="javax.sql.DataSource" driverClassName="org.postgresql.Driver"
        url="jdbc:postgresql://localhost:5432/staplus"
        username="staplus" password="the_pgsql_password"
        maxTotal="20" maxIdle="10" maxWaitMillis="-1"
        defaultAutoCommit="false"
    />
```

#### reload app

Wait for Tomcat to automatically reload the app, or :

 * go to: http://tomcatserver:port/manager/html
 * on table line "/api", click "Reload" button on the right

#### update database

go to: http://tomcatserver:port/api

click "Database Status and Update"

wait for page to load…

click "Do Update" button

### setup authentication

modif `/var/lib/tomcat9/webapps/api/META-INF/context.xml`

```xml
<Parameter override="false" name="auth.provider" value="de.fraunhofer.iosb.ilt.frostserver.auth.basic.BasicAuthProvider"/>

…

<!-- Basic Auth options: -->
    <Parameter override="false" name="auth.realmName" value="Pl@ntNet-STAPLUS" description="The name of the realm that the browser displays when asking for username and password."/>
    <Parameter override="false" name="auth.db_jndi_datasource" value="jdbc/staplus" description="JNDI data source name"/>
    <Parameter override="false" name="auth.autoUpdateDatabase" value="true" description="Automatically apply database updates."/>

```

Wait for app to reload, then update database as described by "update database" chapter above

Basic auth is now set. Default users include "admin" (pw: "admin") that has all capacities. **Don't forget to change this** (see below).

#### change auth users

Update users and roles data directly in PostgreSQL by editing `USERS` and `USER_ROLES` tables.

## Add indexes to speed up queries

Based on the example set of usual queries ran by the unit test (`npm test`), add following indexes into PostgreSQL (if an error occurs, see below).

```sql
psql -U staplus -W staplus

CREATE INDEX "OBSERVATIONS_RESULT_STRING" ON "OBSERVATIONS" using btree ("RESULT_STRING");

CREATE INDEX "OBSERVATIONS_PHENOMENON_TIME_START" ON "OBSERVATIONS" using btree ("PHENOMENON_TIME_START");

CREATE INDEX "OBSERVATIONS_PHENOMENON_TIME_END" ON "OBSERVATIONS" using btree ("PHENOMENON_TIME_END");

CREATE INDEX "DATASTREAMS_PARTY_ID" ON "DATASTREAMS" using btree ("PARTY_ID");

CREATE INDEX "PARTIES_AUTHID" ON "PARTIES" using btree ("AUTHID");

CREATE INDEX "FEATURES_GEOM" ON "FEATURES" using gist ("GEOM");

CREATE INDEX "FEATURES_PROPERTIES_LOCALITY" ON "FEATURES" using btree (("PROPERTIES"#>>'{locality}'));

CREATE INDEX "GROUPS_CREATED_DESC_ID" ON "GROUPS" using btree ("CREATED" desc, "ID" asc);

CREATE INDEX "GROUPS_NAME_DESC_ID" ON "GROUPS" using btree("NAME" DESC, "ID");

```

If first index fails because of text column value too large, check and delete values exceeding 2k characters − they have nothing to do in a determination field anyway !

```sql
SELECT "ID", LENGTH("RESULT_STRING") as l FROM "OBSERVATIONS" WHERE LENGTH("RESULT_STRING") > 2000 ORDER BY LENGTH("RESULT_STRING") DESC;
```

```sql
DELETE FROM "OBSERVATIONS" WHERE LENGTH("RESULT_STRING") > 2000
```