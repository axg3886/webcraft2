const CREATE_TABLE_CHUNKS = `
CREATE TABLE \`chunk\` (
  \`id\` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  \`x\` INT(11) NOT NULL,
  \`z\` INT(11) NOT NULL,
  \`data\` BLOB NOT NULL,
  \`mesh\` BLOB NOT NULL,
  PRIMARY KEY (\`id\`));
`;

const CREATE_NEW_CHUNK = `
  INSERT INTO \`chunk\`
  (\`x\`, \`z\`, \`data\`, \`mesh\`)
  VALUES ($x, $z, $data, $mesh);
`;

const CHUNK_EXISTS = `
SELECT 
    \`data\`, \`mesh\`
FROM
    \`chunk\`
WHERE
    \`x\` = $x && \`z\` = $z;
`;

module.exports.CREATE_TABLE_CHUNKS = CREATE_TABLE_CHUNKS;
module.exports.CREATE_NEW_CHUNK = CREATE_NEW_CHUNK;
module.exports.CHUNK_EXISTS = CHUNK_EXISTS;
