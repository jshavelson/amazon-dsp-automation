import React from 'react';
import { useParams } from 'react-router-dom';

const RouteDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Route Details</h1>
        <p className="text-gray-600">Route ID: {id}</p>
        <p className="text-gray-500 mt-2">This page is under construction.</p>
      </div>
    </div>
  );
};

export default RouteDetailPage;
