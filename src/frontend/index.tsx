import React from 'react';
import ForgeReconciler, { Heading, Spinner, Stack, Text, useProductContext } from '@forge/react';

const App = () => {
  const context = useProductContext();
  if (!context) return <Spinner />;
  const isSetup = context.moduleKey === 'passport-setup';
  return (
    <Stack space="space.300">
      <Heading as="h1">{isSetup ? 'Tool Passport setup' : 'Tool Passport'}</Heading>
      {isSetup ? (
        <Text>The setup wizard arrives in Phase 4.</Text>
      ) : (
        <Text>Ask whether you can do something with a company tool, here and now. The Ask page arrives in Phase 1.</Text>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
