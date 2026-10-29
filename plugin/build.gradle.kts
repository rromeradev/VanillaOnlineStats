plugins { java }

group = "dev.vanillaonlinestats"
version = "0.6.0"

repositories {
    mavenCentral()
    maven("https://repo.codemc.org/repository/maven-public/")
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:26.3.build.227-stable")
    compileOnly("net.skinsrestorer:skinsrestorer-api:15.12.6")
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("com.google.code.gson:gson:2.14.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java { toolchain.languageVersion.set(JavaLanguageVersion.of(25)) }
tasks.withType<JavaCompile>().configureEach { options.encoding = "UTF-8" }
tasks.processResources {
    inputs.property("version", project.version)
    filesMatching("plugin.yml") { expand("version" to project.version) }
}
tasks.test { useJUnitPlatform() }
tasks.jar {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
dependencyLocking { lockAllConfigurations() }
